import { File } from '@platform/types/files';
import {
    IDLTOptions,
    StatisticInfo,
    LevelDistribution,
    EMTIN,
    IDLTFilters,
} from '@platform/types/parsers/dlt';
import { StatEntity, Section } from './structure/statentity';
import { getTypedProp } from '@platform/env/obj';
import { Subject } from '@platform/env/subscription';
import { Filter } from '@ui/env/entities/filter';
import { Summary } from './summary';
import { Timezone } from '@ui/elements/timezones/timezone';

export const ENTITIES = {
    app_ids: 'app_ids',
    context_ids: 'context_ids',
    ecu_ids: 'ecu_ids',
};

export const NAMES: { [key: string]: string } = {
    [ENTITIES.app_ids]: 'Applications',
    [ENTITIES.context_ids]: 'Contexts',
    [ENTITIES.ecu_ids]: 'ECUs',
};

const CLogLevel: { [key: string]: number } = {
    [EMTIN.DLT_LOG_FATAL]: 1,
    [EMTIN.DLT_LOG_ERROR]: 2,
    [EMTIN.DLT_LOG_WARN]: 3,
    [EMTIN.DLT_LOG_INFO]: 4,
    [EMTIN.DLT_LOG_DEBUG]: 5,
    [EMTIN.DLT_LOG_VERBOSE]: 6,
};

export class State {
    public logLevel: EMTIN = EMTIN.DLT_LOG_VERBOSE;
    public structure: Section[] = [];
    public selected: StatEntity[] = [];
    public fibex: File[] = [];
    public stat: StatisticInfo | undefined;
    public filters: {
        entities: Filter;
    } = {
        entities: new Filter(),
    };
    public summary: Summary = new Summary();
    public timezone: Timezone | undefined;

    public isStatLoaded(): boolean {
        return this.stat !== undefined;
    }

    public asOptions(): IDLTOptions {
        const filters: IDLTFilters = {};
        this.selected.forEach((entity) => {
            if ((filters as { [key: string]: string[] })[entity.parent] === undefined) {
                (filters as { [key: string]: string[] })[entity.parent] = [];
            }
            (filters as { [key: string]: string[] })[entity.parent].push(entity.id);
        });
        return {
            logLevel: CLogLevel[this.logLevel] === undefined ? 0 : CLogLevel[this.logLevel],
            filters,
            fibex: this.fibex.map((f) => f.filename),
        };
    }

    public struct(): {
        build(): void;
        remove(target: StatEntity): void;
        back(target: StatEntity): void;
        filter(): void;
        summary(): void;
    } {
        return {
            build: (): void => {
                if (this.stat === undefined) {
                    return;
                }
                const stat = this.stat;
                const structure: Section[] = [];
                ['app_ids', 'context_ids', 'ecu_ids'].forEach((key: string) => {
                    const content: Array<[string, LevelDistribution]> = getTypedProp<
                        StatisticInfo,
                        Array<[string, LevelDistribution]>
                    >(stat, key);
                    const entities: StatEntity[] = content.map((record) => {
                        return new StatEntity(record[0], key, record[1]);
                    });
                    structure.push({
                        key,
                        name: NAMES[key],
                        entities,
                        update: new Subject<void>(),
                    });
                });
                this.structure = structure;
                this.struct().summary();
            },
            remove: (target: StatEntity): void => {
                target.select();
                this.structure.forEach((structure) => {
                    if (structure.key === target.parent) {
                        structure.update.emit();
                    }
                });
                this.struct().summary();
            },
            back: (target: StatEntity): void => {
                target.unselect();
                this.structure.forEach((structure) => {
                    if (structure.key === target.parent) {
                        structure.update.emit();
                    }
                });
                this.struct().summary();
            },
            filter: (): void => {
                this.structure.forEach((structure) => {
                    structure.entities.forEach((entity) =>
                        entity.filter(this.filters.entities.value()),
                    );
                    structure.update.emit();
                });
            },
            summary: (): void => {
                this.summary.reset();
                this.structure.forEach((structure) => {
                    structure.entities.forEach((entity) => {
                        if (this.selected.length === 0) {
                            this.summary.inc(entity);
                        } else if (entity.selected) {
                            this.summary.inc(entity);
                        }
                    });
                });
            },
        };
    }
}