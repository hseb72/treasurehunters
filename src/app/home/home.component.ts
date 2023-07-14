import { Component, OnInit } from '@angular/core';

import { Hunter } from '../core/models/hunter';
import { AuthenticationService } from '../core/services/authentication.service';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit {
/* Test d'interface */
  title = "This is a Test" ;
  isAuthenticated = true ;
/* Fin test Interface */

  hunter: Hunter;

  constructor(private authenticationService: AuthenticationService) {
    this.hunter = this.authenticationService.hunterValue;
  }
  ngOnInit(): void {
  }

/* Test d'interface */
  async logout(): Promise<void> {
    this . isAuthenticated = false ;
  }
/* Fin test Interface */
}