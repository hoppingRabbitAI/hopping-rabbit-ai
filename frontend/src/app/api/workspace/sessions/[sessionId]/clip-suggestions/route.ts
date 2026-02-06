/**
 * clip-suggestions API Route Handler
 * 
 * 使用 Route Handler 代替 rewrites 代理，解决长时间请求被意外断开的问题
 */
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300; // 5 分钟超时（Vercel Edge 限制）
export const dynamic = 'force-dynamic';

export async function POST(
    request: NextRequest,
    { params }: { params: { sessionId: string } }
) {
    const { sessionId } = params;
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    
    try {
        // 转发 Authorization header
        const authHeader = request.headers.get('Authorization');
        const headers: HeadersInit = {
            'Content-Type': 'application/json',
        };
        if (authHeader) {
            headers['Authorization'] = authHeader;
        }
        
        // 调用后端 API
        const response = await fetch(
            `${backendUrl}/api/workspace/sessions/${sessionId}/clip-suggestions`,
            {
                method: 'POST',
                headers,
                // Node.js fetch 不支持 timeout，但 Next.js Route Handler 有 maxDuration
            }
        );
        
        // 返回后端响应
        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
        
    } catch (error) {
        console.error('[clip-suggestions] 代理失败:', error);
        return NextResponse.json(
            { detail: '服务暂时不可用，请稍后重试' },
            { status: 502 }
        );
    }
}
