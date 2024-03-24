/*
This is just a sample implementation and needs a fair bit of changes.
Adding it here only for an overview.
Still need to remove threads, mutex, arc, etc.
This is just a draft proof of concept and has enough room for improvement
and requires implementation of buf_redux.
This is mainly a proof of concept for read_file_until_newline to stop splitting of
pattern across chunks and calculate count of all occurrences of a pattern instead of
just the count of lines where pattern is found.
*/

use grep_regex::RegexMatcher;
use grep_searcher::sinks::UTF8;
use grep_searcher::Searcher;
use rayon::prelude::*;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Instant;
use tokio_util::sync::CancellationToken;
use std::fs::File;
use std::io::{self, BufReader, Read};

#[derive(Debug)]
pub struct SearchResult {
    pub file_path: String,
    pub pattern_counts: HashMap<String, usize>,
    pub error_message: Option<String>,
}

pub struct TextGrep;

impl Default for TextGrep {
    fn default() -> Self {
        TextGrep::new()
    }
}

impl TextGrep {
    pub fn new() -> Self {
        TextGrep
    }

    pub async fn count_occurrences(
        &self,
        patterns: Vec<&str>,
        file_paths: Vec<&str>,
        chunk_size: usize,
        case_sensitive: bool,
        cancel_token: CancellationToken,
    ) -> Result<Vec<SearchResult>, String> {
        let mut results = Vec::new();
        let cancel_token_clone = cancel_token.clone();

        let (sender, receiver) = mpsc::channel();
        let (error_sender, error_receiver) = mpsc::channel();

        let patterns_arc: Vec<_> = patterns.iter().map(|&p| Arc::from(p)).collect();
        let file_paths_arc: Vec<_> = file_paths.iter().map(|&fp| Arc::from(fp)).collect();

        let thread_handles: Vec<_> = file_paths_arc
            .par_iter()
            .map(|file_path| {
                let patterns = patterns_arc.clone();
                let sender = sender.clone();
                let error_sender_clone = error_sender.clone();
                let cancel_token = cancel_token_clone.clone();
                let file_path = Arc::clone(file_path);
                if let Err(err) =
                    process_file(&file_path, &patterns, chunk_size, case_sensitive, &cancel_token, &sender)
                {
                    if error_sender_clone.send(err.to_string()).is_err() {
                        eprintln!("Error sending error message through channel");
                    }
                }
            })
            .collect();

        // for handle in thread_handles {
        //     handle.join().unwrap();
        // }

        while let Ok(err_msg) = error_receiver.try_recv() {
            eprintln!("Error processing file: {:?}", err_msg);
            results.push(SearchResult {
                file_path: "".to_string(),
                pattern_counts: HashMap::new(),
                error_message: Some(err_msg.to_string()),
            });
        }

        while let Ok(search_result) = receiver.try_recv() {
            results.push(search_result?);
        }

        Ok(results)
    }
}

fn process_file(
    file_path: &Arc<str>,
    patterns: &[Arc<str>],
    chunk_size: usize,
    case_sensitive: bool,
    cancel_token: &CancellationToken,
    sender: &Sender<Result<SearchResult, String>>,
) -> Result<(), String> {
    let file_path = PathBuf::from(&**file_path);

    if !is_text_file(&file_path) {
        let error_msg = format!("File '{}' is not a text file", file_path.display());
        if sender.send(Err(error_msg.clone())).is_err() {
            eprintln!("Error sending search result through channel");
        }
        return Ok(());
    }

    let start_time = Instant::now();
    let pattern_counts = HashMap::new();

    let mut file = std::fs::File::open(&file_path).map_err(|e| e.to_string())?;
    let mut buffer = vec![0; chunk_size]; // define a buffer to read chunks of data

    // create matchers for each pattern and store them with their corresponding patterns in a hashmap
    let mut matchers = HashMap::new();
    for pattern in patterns {
        let pattern_string = pattern.as_ref().to_string();
        let matcher = RegexMatcher::new(&pattern_string).map_err(|e| e.to_string())?;
        matchers.insert(pattern_string, matcher);
    }

    let pattern_counts_mutex = Arc::new(Mutex::new(pattern_counts));

    let mut threads = vec![];

    loop {
        if cancel_token.is_cancelled() {
            return Err("Operation cancelled".to_string());
        }

        let bytes_read = read_file_until_newline(&mut file, &mut buffer, chunk_size).map_err(|e| e.to_string())?;
        if bytes_read == 0 {
            break; // Reached EOF
        }

        let matchers_clone = matchers.clone();
        let pattern_counts_mutex_clone = pattern_counts_mutex.clone();
        let buffer_clone = buffer.clone();

        let thread_handle = thread::spawn(move || {
            let mut local_pattern_counts = HashMap::new();

            for (pattern, matcher) in &matchers_clone {
                let mut total_count = 0;
                let mut searcher = Searcher::new();

                searcher
                    .search_reader(
                        matcher,
                        &buffer_clone[..bytes_read],
                        UTF8(|_, line| {
                            total_count += line.matches(pattern).count();
                            Ok(true)
                        }),
                    )
                    .map_err(|e| e.to_string())
                    .unwrap();

                local_pattern_counts.insert(pattern.clone(), total_count);
            }

            let mut pattern_counts_mutex_guard = pattern_counts_mutex_clone.lock().unwrap();
            for (pattern, count) in local_pattern_counts {
                *pattern_counts_mutex_guard.entry(pattern).or_insert(0) += count;
            }
        });

        threads.push(thread_handle);
    }

    for thread in threads {
        thread.join().unwrap();
    }

    let end_time = start_time.elapsed();
    eprintln!("Time taken {:?}", end_time);

    let pattern_counts_mutex_guard = pattern_counts_mutex.lock().unwrap();
    let aggregated_pattern_counts = pattern_counts_mutex_guard.clone();

    sender
        .send(Ok(SearchResult {
            file_path: file_path.to_string_lossy().into_owned(),
            pattern_counts: aggregated_pattern_counts,
            error_message: None,
        }))
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn read_file_until_newline(file: &mut File, buffer: &mut Vec<u8>, chunk_size: usize) -> io::Result<usize> {
    let mut bytes_read = 0;

    loop {
        // Read a chunk of data into the buffer
        let chunk = file.read(&mut buffer[bytes_read..bytes_read + chunk_size])?;

        // Update the total bytes read
        bytes_read += chunk;

        // If we've reached the end of the file or encountered a newline, break
        if chunk == 0 || buffer[bytes_read - 1] == b'\n' {
            break;
        }

        // If buffer is full, extend it to accommodate more data
        if bytes_read + chunk_size > buffer.len() {
            buffer.resize(bytes_read + chunk_size, 0);
        }
    }

    Ok(bytes_read)
}

fn is_text_file(_file_path: &Path) -> bool {
    true
}