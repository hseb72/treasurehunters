import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';

import { environment } from '../../../environments/environment';
import {Hunt} from '../models/hunt'

const httpOptions = {
  headers: new HttpHeaders({ 'Content-Type': 'application/json' })
};

@Injectable({ providedIn: 'root' })
export class HuntService {
  constructor(private http: HttpClient) { }

  getAll() {
    return this.http.get(`${environment.HunApiUrl}`);
  }

  getHunt(id: string) {
    return this.http.get(`${environment.HunApiUrl}/${id}`);
  }

  putHunt(content: string) {
    return this.http.put(`${environment.HunApiUrl}`, `${content}`, httpOptions) ;
  }

  postHunt(content: string) {
    return this.http.post(`${environment.HunApiUrl}`, `${content}`, httpOptions) ;
  }

  patchHunt(id: string, content: string) {
    return this.http.patch(`${environment.HunApiUrl}/${id}`, `${content}`, httpOptions) ;
  }

  deleteHunt(id: string) {
    return this.http.delete(`${environment.HunApiUrl}/${id}`) ;
  }

  getHunts() {
    return this.http.get(`${environment.HunApiUrl}`);
  }

  getQuests(id: string) {
    return this.http.get(`${environment.HunApiUrl}/questsof/${id}`);
  }

  getTreasures<Hunt>(id: string) {
    return this.http.get(`${environment.HunApiUrl}/treasuresof/${id}`);
  }

}