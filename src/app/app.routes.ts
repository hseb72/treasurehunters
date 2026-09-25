import { Routes } from '@angular/router';
import { environment } from '../environments/environment';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', title: 'Carnet de bord', loadComponent: () => import('./pages/home/home').then((m) => m.HomePage) },
  { path: 'login', title: 'Connexion', loadComponent: () => import('./pages/login/login').then((m) => m.LoginPage) },
  { path: 'me', title: 'Mon profil', canActivate: [authGuard], loadComponent: () => import('./pages/profile/profile').then((m) => m.ProfilePage) },
  { path: 'hunts/:id', title: 'Expédition', loadComponent: () => import('./pages/hunt-detail/hunt-detail').then((m) => m.HuntDetailPage) },
  { path: 'hunts/:id/results', title: 'Résultats', loadComponent: () => import('./pages/results/results').then((m) => m.ResultsPage) },
  { path: 'play/:id', title: 'Carnet de route', canActivate: [authGuard], loadComponent: () => import('./pages/play/play').then((m) => m.PlayPage) },
  { path: 'generate', title: 'Chasse sur mesure', canActivate: [authGuard], loadComponent: () => import('./pages/generate/generate').then((m) => m.GeneratePage) },
  { path: 'scan', title: 'Scanner', loadComponent: () => import('./pages/scanner/scanner').then((m) => m.ScannerPage) },
  { path: 'q/:token', title: 'Indice', loadComponent: () => import('./pages/scan-result/scan-result').then((m) => m.ScanResultPage) },
  {
    path: 'organize',
    canActivate: [authGuard],
    children: [
      { path: '', title: 'Mes expéditions', loadComponent: () => import('./pages/organize/organize-list').then((m) => m.OrganizeListPage) },
      { path: 'new', title: 'Nouvelle chasse', loadComponent: () => import('./pages/organize/hunt-form').then((m) => m.HuntFormPage) },
      {
        path: ':id',
        loadComponent: () => import('./pages/organize/workspace').then((m) => m.WorkspacePage),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'info' },
          { path: 'info', title: 'Informations', loadComponent: () => import('./pages/organize/hunt-form').then((m) => m.HuntFormPage) },
          { path: 'steps', title: 'Étapes', loadComponent: () => import('./pages/organize/steps-editor').then((m) => m.StepsEditorPage) },
          { path: 'teams', title: 'Équipes', loadComponent: () => import('./pages/organize/teams-panel').then((m) => m.TeamsPanelPage) },
          { path: 'qrcodes', title: 'QR codes', loadComponent: () => import('./pages/organize/qr-sheet').then((m) => m.QrSheetPage) },
          { path: 'live', title: 'Direct', loadComponent: () => import('./pages/organize/live-board').then((m) => m.LiveBoardPage) },
        ],
      },
    ],
  },
  ...(environment.demo ? [{ path: 'demo', title: 'Guide de démonstration', loadComponent: () => import('./pages/demo/demo').then((m) => m.DemoPage) }] : []),
  { path: '**', redirectTo: '' },
];
