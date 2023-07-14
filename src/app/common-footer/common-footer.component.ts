import { Component, OnInit } from '@angular/core';

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

@Component({
  selector: 'app-common-footer',
  templateUrl: './common-footer.component.html',
  styleUrls: ['./common-footer.component.scss']
})
export class CommonFooterComponent implements OnInit {

  isLoggedIn = false ;

  constructor() { }

  ngOnInit(): void {
  }

}
