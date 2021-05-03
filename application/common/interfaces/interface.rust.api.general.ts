export interface IMatchEntity {
	filter: string;
	match: string;
	row: number;
}

export interface IMapEntity {
    filter: string;
    rows: number[];
}

export interface IFilterFlags {
	reg: boolean,
	word: boolean,
	cases: boolean,
}

export interface IFilter {
	filter: string,
	flags: IFilterFlags,
}

export interface IGrabbedContent {
	grabbed_elements: IGrabbedElement[],
}

export interface IGrabbedElement {
    source_id: string,
    content: string,
}