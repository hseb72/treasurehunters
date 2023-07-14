import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { HunterRoutingModule } from './hunter-routing.module';
import { PersonalComponent } from './personal/personal.component';
import { TreasureComponent } from './treasure/treasure.component';
import { QuestComponent } from './quest/quest.component';


@NgModule({
  declarations: [
    PersonalComponent,
    TreasureComponent,
    QuestComponent
  ],
  imports: [
    CommonModule,
    HunterRoutingModule
  ]
})
export class HunterModule { }
