import { redirect } from 'next/navigation';

/* /p 无项目 ID → 跳到 Explore */
export default function ProjectIndexPage() {
  redirect('/explore');
}
