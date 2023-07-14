import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { first } from 'rxjs/operators';

import { AuthenticationService } from '../core/services/authentication.service';
//import { AlertService } from '../core/services/alert.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})

export class LoginComponent implements OnInit {
    form: FormGroup;
    loading = false;
    submitted = false;
    returnUrl: string;

    /* okta test */
    public loginInvalid = false;
    private formSubmitAttempt = false;

    constructor(
      private reactiveFormsModule: ReactiveFormsModule,
      private formBuilder: FormBuilder,
      private route: ActivatedRoute,
      private router: Router,
      private authenticationService: AuthenticationService,
      //private alertService: AlertService
    ) {
      this.returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/';
      this.router.navigate([this.returnUrl]);

      this.form = this.formBuilder.group({
        username: ['', Validators.required],
        password: ['', Validators.required]
      });
  }

    ngOnInit() {
        // get return url from route parameters or default to '/'
        /* test Okta *
        if (await this.authenticationService.checkAuthenticated()) {
          await this.router.navigate([this.returnUrl]);
        }
        /*/
        this.router.navigate([this.returnUrl]);
    }

    // convenience getter for easy access to form fields
    get f() { return this.form.controls; }

    /* Test Okta *
    async onSubmit(): Promise<void> {
      this.loginInvalid = false;
      this.formSubmitAttempt = false;
      if (this.form.valid) {
        try {
          const username = this.form.get('username')?.value;
          const password = this.form.get('password')?.value;
          await this.authenticationService.login(username, password);
        } catch (err) {
          this.loginInvalid = true;
        }
      } else {
        this.formSubmitAttempt = true;
      }
    }

/* this.submitted = true; */

    onSubmit() {
        // reset alerts on submit
        //this.alertService.clear();

        // stop here if form is invalid
        if (this.form.invalid) {
            return;
        }

        this.loading = true;
        this.authenticationService.login(this.f['username'].value, this.f['password'].value)
            .pipe(first())
            .subscribe(
                data => {
                    this.router.navigate([this.returnUrl]);
                },
                error => {
                    //this.alertService.error(error);
                    this.loading = false;
                });
  }
              /**/
    
}