import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { rxResource, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { debounceTime } from 'rxjs';
import { CatalogQuery, HuntApi } from '../../core/api';
import { CatalogCard } from '../../shared/catalog-card';

/** Catalogue public des chasses (§ 13) : chercher, comparer, puis ouvrir une fiche. */
@Component({
  selector: 'th-catalog',
  imports: [CatalogCard, FormsModule, MatButtonToggleModule, MatFormFieldModule, MatIconModule, MatInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog.html',
  styleUrl: './catalog.scss',
})
export class CatalogPage {
  private readonly api = inject(HuntApi);

  protected readonly query = signal('');
  protected readonly sort = signal<NonNullable<CatalogQuery['sort']>>('rating');
  private readonly debounced = toSignal(toObservable(this.query).pipe(debounceTime(300)), { initialValue: '' });

  protected readonly entries = rxResource({
    params: () => ({ q: this.debounced(), sort: this.sort() }),
    stream: ({ params }) => this.api.listCatalog(params),
    defaultValue: [],
  });
}
