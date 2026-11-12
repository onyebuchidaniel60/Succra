import { redirect } from 'next/navigation';

export default function DemoPage(): never {
  redirect('/missions/demo');
}
