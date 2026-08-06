type Props = {
  title: string;
  blurb: string;
};

export function ComingSoonPage({ title, blurb }: Props) {
  return (
    <div className="coming-soon">
      <h1>{title}</h1>
      <p className="muted">{blurb}</p>
      <p className="muted coming-soon__note">Coming soon — stand-in screen for layout work.</p>
    </div>
  );
}
