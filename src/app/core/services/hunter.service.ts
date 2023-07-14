import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';

import { environment } from '../../../environments/environment';

const httpOptions = {
  headers: new HttpHeaders({ 'Content-Type': 'application/json' })
};

@Injectable({ providedIn: 'root' })
export class HunterService {
  constructor(private http: HttpClient) { }

  getAll() {
    return this.http.get(`${environment.HtrApiUrl}`);
  }

  getHunter(id: string) {
    return this.http.get(`${environment.HtrApiUrl}/${id}`);
  }

  putHunter(content: string) {
    return this.http.put(`${environment.HtrApiUrl}`, `${content}`, httpOptions) ;
  }

  postHunter(content: string) {
    return this.http.post(`${environment.HtrApiUrl}`, `${content}`, httpOptions) ;
  }

  patchHunter(id: string, content: string) {
    return this.http.patch(`${environment.HtrApiUrl}/${id}`, `${content}`, httpOptions) ;
  }

  deleteHunter(id: string) {
    return this.http.delete(`${environment.HtrApiUrl}/${id}`) ;
  }
  getHunters() {
    return this.http.get(`${environment.HtrApiUrl}`);
  }

  authenticate(email: string, password: string) {
    return this.http.post<any>(`${environment.HtrApiUrl}/authenticate`, {email, password});
  }

  isLoggedIn<User>(id: number) {
    return this.http.get(`${environment.HtrApiUrl}/${id}/loggedin`);
  }

  patchHunterSecrets(id: string, content: string) {
    return this.http.patch(`${environment.HtrApiUrl}/${id}/secret`, `${content}`, httpOptions) ;
  }
}