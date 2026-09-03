import { Routes } from '@angular/router';
import { PlaygroundComponent } from './components/playground/playground.component.js';
import { MigrationWorkbenchComponent } from './components/migration-workbench/migration-workbench.component.js';

export const routes: Routes = [
  { path: '', component: PlaygroundComponent },
  { path: 'migration', component: MigrationWorkbenchComponent },
  { path: '**', redirectTo: '' },
];
