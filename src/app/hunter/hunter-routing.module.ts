import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from '../core/guards/auth.guards' ;

import { PersonalComponent} from './personal/personal.component' ;
import { QuestComponent} from './quest/quest.component' ;
import { TreasureComponent} from './treasure/treasure.component' ;

const routes: Routes = [
  { path: 'hunter/personal', component: PersonalComponent, canActivate: [AuthGuard] },
  { path: 'hunter/quest', component: QuestComponent, canActivate: [AuthGuard] },
  { path: 'hunter/treasure', component: TreasureComponent, canActivate: [AuthGuard] },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class HunterRoutingModule { }
