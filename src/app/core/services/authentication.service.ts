import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../../environments/environment';
import { Hunter } from '../models/hunter';
import { HunterService } from './hunter.service';

const EMPTY_HUNTER = { id: 0, email: '', nickname: '' };

@Injectable({ providedIn: 'root' })
export class AuthenticationService {
    private HunterSubject: BehaviorSubject<Hunter>;
    public Hunter: Observable<Hunter>;

    constructor(
        private router: Router,
        private http: HttpClient,
        private hunterService: HunterService
    ) {
        var Hunter = localStorage.getItem('Hunter') ;
        if ( ! Hunter ) { Hunter = JSON.stringify(EMPTY_HUNTER) ; }
        this.HunterSubject = new BehaviorSubject<Hunter>(JSON.parse(Hunter));
        this.Hunter = this.HunterSubject.asObservable();    
    }

    public get hunterValue(): Hunter {
        return this.HunterSubject.value;
    }

    login(username: any, password: any) {
        /* fake login *
        const Hunter = { id: 1, email: username, nickname: 'Fake', lastName: 'Hunter' }
        localStorage.setItem('Hunter', JSON.stringify(Hunter));
        this.HunterSubject.next(Hunter);
        //return Hunter;
        /* End of fake Hunter - restore return string below to enable true login */

//        return this.http.post<Hunter>(`${environment.HtrApiUrl}/authenticate`, { Huntername, password })
        return this.hunterService.authenticate(username, password)
            .pipe(map(Hunter => {
                // store Hunter details and jwt token in local storage to keep Hunter logged in between page refreshes
                localStorage.setItem('Hunter', JSON.stringify(Hunter));
                this.HunterSubject.next(Hunter);
                return Hunter;
            }));
            /**/
    }

    logout() {
        // remove Hunter from local storage and set current Hunter to null
        localStorage.removeItem('Hunter');
        this.HunterSubject.next(EMPTY_HUNTER);
        this.router.navigate(['/']);
    }

    register(Hunter: Hunter) {
        return this.http.post(`${environment.HunApiUrl}/register`, Hunter);
    }

    getAll() {
        return this.http.get<Hunter[]>(`${environment.HunApiUrl}`);
    }

    getById(id: string) {
        return this.http.get<Hunter>(`${environment.HunApiUrl}/${id}`);
    }

    update(id: number, params: any) {
        return this.http.put(`${environment.HunApiUrl}/${id}`, params)
            .pipe(map(x => {
                // update stored Hunter if the logged in Hunter updated their own record
                if (id == this.hunterValue.id) {
                    // update local storage
                    const Hunter = { ...this.hunterValue, ...params };
                    localStorage.setItem('Hunter', JSON.stringify(Hunter));

                    // publish updated Hunter to subscribers
                    this.HunterSubject.next(Hunter);
                }
                return x;
            }));
    }

    delete(id: number) {
        return this.http.delete(`${environment.HunApiUrl}/${id}`)
            .pipe(map(x => {
                // auto logout if the logged in Hunter deleted their own record
                if (id == this.hunterValue.id) {
                    this.logout();
                }
                return x;
            }));
    }
}