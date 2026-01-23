import { redirect } from "next/navigation";

export default function HomePage() {
  // 首页重定向到工作台
  redirect('/workspace');
}

