import { Component } from '@angular/core';
import { HuntService } from "../../core/services/hunt.service"
import { Hunt } from "../../core/models/hunt"
import { DatePipe } from '@angular/common';
@Component({
  selector: 'app-treasure',
  templateUrl: './treasure.component.html',
  styleUrls: ['./treasure.component.scss'],
  providers: [DatePipe]
})
export class TreasureComponent {
  currentUser: any = 0;
  hunter: any;
  hunt!: Array<Hunt>;
  today: string = "" ;

  constructor(private huntService: HuntService, datepipe: DatePipe) {
    this . today = "" + datepipe . transform ( new Date(), "YYYY-MM-dd hh:mm:ss") ;
    
    var hunter = localStorage.getItem('Hunter') ;
    if (hunter) this . currentUser = JSON.parse(hunter) . id ;

    this . huntService . getTreasures ( this . currentUser + "")
    . subscribe ({
      next: (htr) => { 
        this . hunt = JSON . parse ( JSON . stringify ( htr ) ) ;
      }
    });
  }
}