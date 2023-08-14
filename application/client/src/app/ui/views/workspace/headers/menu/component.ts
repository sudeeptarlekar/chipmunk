import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    Input,
} from '@angular/core';
import { Columns } from '@schema/render/columns';
import { ChangesDetector } from '@ui/env/extentions/changes';
import { contextmenu } from '@ui/service/contextmenu';
import { CColors } from '@ui/styles/colors';

@Component({
    selector: 'app-scrollarea-rows-columns-headers-context-menu',
    styleUrls: ['./styles.less'],
    templateUrl: './template.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewWorkspaceHeadersMenuComponent extends ChangesDetector {
    public selectedColumn: number | undefined = undefined;
    public colors: string[] = CColors;

    @Input() public column!: number;
    @Input() public controller!: Columns;

    constructor(cdRef: ChangeDetectorRef) {
        super(cdRef);
    }

    public ngOnCheckboxClick(event: MouseEvent, i: number): void {
        event.stopPropagation();
        this.controller.toggleVisibility(i);
        this.detectChanges();
    }

    public ngOnColorClick(_event: MouseEvent, color: string): void {
        this.controller.setColor(this.column, color);
        this.detectChanges();
    }
}