import { Component } from '@angular/core';

@Component({
  selector: 'app-common-header',
  templateUrl: './common-header.component.html',
  styleUrls: ['./common-header.component.scss']
})

export class CommonHeaderComponent {
  public isMenuOpen = false;
  displayedColumns: string[] = ['month', 'monthname', 'workeddays', 'offdays', 'status'];

  constructor() { }

  ngOnInit(): void {
  }

  andMore () {
    this . isMenuOpen = ! this . isMenuOpen ;
    //this . sidenav 
  }

}
