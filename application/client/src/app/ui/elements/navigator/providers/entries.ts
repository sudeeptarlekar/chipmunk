import { Entity } from './entity';
import { Filter } from '@elements/filter/filter';
import { Subject } from '@platform/env/subscription';
import { IlcInterface } from '@service/ilc';
import { ChangesDetector } from '@ui/env/extentions/changes';
import { createPassiveMatcheeList } from '@module/matcher';

import * as wasm from '@loader/wasm';

const MAX_VISIBLE_ITEMS = 35;
const ELEMENT_HEIGHT = 28;

interface ICollection {
    title: string;
    total: number;
    entries: Entity[];
    index: number;
}

export class Entries {
    protected readonly entries: Map<number, ICollection> = new Map();

    public readonly filter: Filter;
    public selected: string = '';

    constructor(
        protected readonly uuid: string,
        protected readonly ilc: IlcInterface & ChangesDetector,
        protected readonly matcher: wasm.Matcher,
        protected readonly update: Subject<void>,
    ) {
        this.filter = new Filter(ilc, { placeholder: 'Type to filter' });
        ilc.env().subscriber.register(
            this.filter.subjects.get().change.subscribe((value: string) => {
                this.filtering(value);
                ilc.markChangesForCheck();
            }),
        );
    }

    protected filtering(value: string): void {
        this.matcher.search(value, 'span');
        this.entries.forEach((entries) => {
            entries.entries.sort((a: Entity, b: Entity) => b.getScore() - a.getScore());
        });
        this.defaultSelection();
        this.move().update();
        this.update.emit();
    }

    protected all(): Entity[] {
        let filtered: Entity[] = [];
        this.entries.forEach((collection: ICollection) => {
            filtered = filtered.concat(
                collection.entries
                    .filter((a: Entity) => a.getScore() > 0)
                    .slice(0, MAX_VISIBLE_ITEMS),
            );
        });
        return filtered;
    }

    public defaultSelection() {
        this.selected = '';
        this.entries.forEach((entries) => {
            if (this.selected !== '') {
                return;
            }
            if (entries.entries.length > 0) {
                this.selected = entries.entries[0].uuid;
            }
        });
    }

    public add(index: number, title: string, entries: Entity[]) {
        this.entries.set(index, {
            title,
            index,
            total: entries.length,
            entries: createPassiveMatcheeList<Entity>(entries, this.matcher),
        });
    }

    public len(): number {
        return Array.from(this.entries.values())
            .map((collection) => collection.entries.length)
            .reduce((partialSum, a) => partialSum + a, 0);
    }

    public filtered(): ICollection[] {
        return Array.from(this.entries.values()).map((collection: ICollection) => {
            return {
                index: collection.index,
                title: collection.title,
                total: collection.total,
                entries: collection.entries
                    .filter((a: Entity) => a.getScore() > 0)
                    .slice(0, MAX_VISIBLE_ITEMS),
            };
        });
    }

    public getSelected(): Entity | undefined {
        let entity: Entity | undefined;
        this.entries.forEach((collection: ICollection) => {
            if (entity !== undefined) {
                return;
            }
            entity = collection.entries.find((a) => a.uuid === this.selected);
        });
        return entity;
    }

    public move(): {
        up(): void;
        down(): void;
        update(): void;
        scrollIntoView(index: number): void;
    } {
        const entries = this.all();
        return {
            up: (): void => {
                if (entries.length === 0) {
                    return;
                }
                if (this.selected === '') {
                    this.selected = entries[entries.length - 1].uuid;
                    return;
                }
                const index = entries.findIndex((a) => a.uuid === this.selected);
                this.move().scrollIntoView(
                    (() => {
                        if (index === -1 || index === 0) {
                            this.selected = entries[entries.length - 1].uuid;
                            return entries.length - 1;
                        } else {
                            this.selected = entries[index - 1].uuid;
                            return index - 1;
                        }
                    })(),
                );
            },
            down: (): void => {
                if (entries.length === 0) {
                    return;
                }
                if (this.selected === '') {
                    this.selected = entries[0].uuid;
                    return;
                }
                const index = entries.findIndex((a) => a.uuid === this.selected);
                this.move().scrollIntoView(
                    (() => {
                        if (index === -1 || index === entries.length - 1) {
                            this.selected = entries[0].uuid;
                            return 0;
                        } else {
                            this.selected = entries[index + 1].uuid;
                            return index + 1;
                        }
                    })(),
                );
            },
            update: (): void => {
                if (entries.length === 0) {
                    return;
                }
                if (this.selected === '') {
                    this.selected = entries[0].uuid;
                    return;
                }
                const index = entries.findIndex((a) => a.uuid === this.selected);
                if (index === -1) {
                    this.selected = entries[0].uuid;
                }
            },
            scrollIntoView: (index: number): void => {
                const container = document.querySelector(`div[id="${this.uuid}"]`);
                if (container === undefined || container === null) {
                    return;
                }
                const size = container.getBoundingClientRect();
                const offset = index * ELEMENT_HEIGHT;
                if (
                    offset >= container.scrollTop &&
                    offset + ELEMENT_HEIGHT <= size.height + container.scrollTop
                ) {
                    return;
                }
                container.scrollTo(0, offset + ELEMENT_HEIGHT - size.height);
            },
        };
    }
}