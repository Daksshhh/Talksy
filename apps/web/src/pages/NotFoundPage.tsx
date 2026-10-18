import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { LogoMark } from '@/components/ui/Logo';

export default function NotFoundPage() {
  return (
    <div className="grid min-h-[100dvh] place-items-center px-6 text-center">
      <div>
        <LogoMark className="mx-auto h-14 w-14" />
        <h1 className="mt-4 text-3xl font-extrabold">Lost in orbit</h1>
        <p className="mt-2 text-muted">This page doesn't exist.</p>
        <Link to="/"><Button className="mt-6">Back home</Button></Link>
      </div>
    </div>
  );
}
