import { redirect } from 'next/navigation';

/* Discover — 已迁移到 /p sidebar 面板 */
export default function DiscoverPage() {
  redirect('/explore');
}
