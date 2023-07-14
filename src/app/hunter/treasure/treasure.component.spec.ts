import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TreasureComponent } from './treasure.component';

describe('TreasureComponent', () => {
  let component: TreasureComponent;
  let fixture: ComponentFixture<TreasureComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [TreasureComponent]
    });
    fixture = TestBed.createComponent(TreasureComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
