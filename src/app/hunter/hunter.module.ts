import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { HunterRoutingModule } from './hunter-routing.module';
import { PersonalComponent } from './personal/personal.component';
import { TreasureComponent } from './treasure/treasure.component';
import { QuestComponent } from './quest/quest.component';

import { MatButtonModule } from '@angular/material/button' ;
import { MatIconModule } from '@angular/material/icon' ;
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatTableModule } from '@angular/material/table';
import { MatToolbarModule } from '@angular/material/toolbar';

const uiModules = [
  MatSidenavModule,
  MatIconModule,
  MatButtonModule,
  MatCardModule,
  MatListModule,
  MatTableModule,
  MatToolbarModule
];
@NgModule({
  declarations: [
    PersonalComponent,
    TreasureComponent,
    QuestComponent
  ],
  imports: [
    uiModules,
    CommonModule,
    HunterRoutingModule
  ]
})
export class HunterModule { }
