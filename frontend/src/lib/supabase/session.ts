/**
 * Supabase Session 工具函数
 * 统一管理 session 获取，避免重复代码
 */
import { createClient, Session } from '@supabase/supabase-js';

// Supabase 客户端配置
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// 单例 Supabase 客户端
let _supabaseClient: ReturnType<typeof createClient> | null = null;

/**
 * 获取 Supabase 客户端 (单例)
 */
export function getSupabaseClient() {
  if (!_supabaseClient) {
    _supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  }
  return _supabaseClient;
}

/**
 * 安全获取 Session，不抛出错误
 * 用于需要认证的 API 调用
 * 
 * @returns Session 对象或 null
 */
export async function getSessionSafe(): Promise<Session | null> {
  try {
    const supabase = getSupabaseClient();
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.warn('[Session] 获取 session 失败:', error.message);
      return null;
    }
    return session;
  } catch (err) {
    console.warn('[Session] session 不可用');
    return null;
  }
}

/**
 * 获取 Access Token
 * 用于设置 Authorization header
 * 
 * @returns access_token 字符串或 null
 */
export async function getAccessToken(): Promise<string | null> {
  const session = await getSessionSafe();
  return session?.access_token ?? null;
}

/**
 * 创建带认证的 fetch headers
 * 
 * @param contentType 可选的 Content-Type
 * @returns Headers 对象
 */
export async function createAuthHeaders(contentType?: string): Promise<HeadersInit> {
  const token = await getAccessToken();
  const headers: HeadersInit = {};
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  
  return headers;
}

/**
 * 带认证的 fetch 封装
 * 自动添加 Authorization header
 * 
 * @param url 请求 URL
 * @param options fetch 选项
 * @returns fetch Response
 */
export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const session = await getSessionSafe();
  
  const headers = new Headers(options.headers);
  
  if (session?.access_token) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }
  
  return fetch(url, {
    ...options,
    headers,
  });
}
