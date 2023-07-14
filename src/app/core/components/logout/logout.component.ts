import { Component, OnInit } from '@angular/core';
import { AuthenticationService } from "../../services/authentication.service"
@Component({
  selector: 'app-logout',
  templateUrl: './logout.component.html',
  styleUrls: ['./logout.component.scss']
})
export class LogoutComponent implements OnInit {

  constructor(public authenticationService: AuthenticationService) { }

  ngOnInit(): void {
    this . authenticationService . logout () ;
  }

}
