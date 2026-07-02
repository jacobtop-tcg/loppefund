import Link from 'next/link';
import { TipForm } from './TipForm.tsx';

export const metadata = {
  title: 'Tip et marked — Loppefund',
  description:
    'Kender du et loppemarked, vi mangler? Indsæt et link eller opslagets tekst — fx fra en Facebook-gruppe — så kommer det med.',
};

export default function TipPage() {
  return (
    <div className="container">
      <Link href="/" className="back-link">
        ← Alle markeder
      </Link>
      <header className="detail-header">
        <div className="detail-category">Hjælp fællesskabet</div>
        <h1 className="detail-title">Tip et marked</h1>
        <p className="detail-place" style={{ maxWidth: '52ch' }}>
          Meget af guldet bliver kun delt i lokale Facebook-grupper. Har du set et
          loppemarked, en garagesalgsdag eller et kræmmermarked, vi mangler? Indsæt
          linket eller kopiér opslagets tekst herunder — så gør vi resten.
        </p>
      </header>
      <div className="detail-grid" style={{ gridTemplateColumns: '1fr', maxWidth: 640 }}>
        <TipForm />
      </div>
    </div>
  );
}
