import { Component } from '@angular/core';
import { HuntService } from "../../core/services/hunt.service"
import { Hunt } from "../../core/models/hunt"
import { DatePipe } from '@angular/common';

@Component({
  selector: 'app-quest',
  templateUrl: './quest.component.html',
  styleUrls: ['./quest.component.scss'],
  providers: [DatePipe]
})
export class QuestComponent {
  currentUser: any = 0;
  hunter: any;
  hunt!: Array<Hunt>;
  //today: Date = new Date ();
  today: string = "" ;

  constructor(private huntService: HuntService, datepipe: DatePipe) {
    this . today = "" + datepipe . transform ( new Date(), "YYYY-MM-dd hh:mm:ss") ;

    var hunter = localStorage.getItem('Hunter') ;
    if (hunter) this . currentUser = JSON.parse(hunter) . id ;

    this . huntService . getQuests ( this . currentUser + "")
    . subscribe ({
      next: (htr) => { 
        this . hunt = JSON . parse ( JSON . stringify ( htr ) ) ;
      }
    });
  }
}