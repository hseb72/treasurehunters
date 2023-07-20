import { Component } from '@angular/core';
import { EmptyError } from 'rxjs';
import { HunterService } from "../../core/services/hunter.service"

@Component({
  selector: 'app-personal',
  templateUrl: './personal.component.html',
  styleUrls: ['./personal.component.scss']
})
export class PersonalComponent {
  currentUser: any = 0;
  hunter: any;

  constructor(private hunterService: HunterService) { 
    var hunter = localStorage.getItem('Hunter') ;
    if (hunter) this . currentUser = JSON.parse(hunter) . id ;

    this . hunterService . getHunter ( this . currentUser )
    . subscribe ( 
      htr => { 
        this . hunter = htr ; 
        console.log ( JSON . stringify ( htr ) ) 
      }
    );
  }

  ngOnInit(): void {
  }

}