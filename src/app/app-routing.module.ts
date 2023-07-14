import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuthGuard } from "./core/guards/auth.guards" ;

import { HomeComponent } from "./home/home.component" ;
import { LoginComponent } from "./login/login.component" ;
import { LogoutComponent } from "./core/components/logout/logout.component" ;

const routes: Routes = [
//  { path: '', component: HomeComponent, canActivate: [AuthGuard] }, /* uncomment this to make the force a connexion when accessing the app, then comment the next line */
  { path: '', component: HomeComponent },
  { path: 'login',  component: LoginComponent },
  { path: 'logout',  component: LogoutComponent },

// otherwise redirect to home
//  { path: '**', redirectTo: '' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, {scrollPositionRestoration: 'enabled'})],
  exports: [RouterModule]
})
export class AppRoutingModule { }
