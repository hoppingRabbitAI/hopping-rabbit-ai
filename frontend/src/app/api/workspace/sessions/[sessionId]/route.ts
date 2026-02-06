/**
 * Session GET API Route Handler
 * 
 * 获取单个 session 的详细信息
 */
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
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
            `${backendUrl}/api/workspace/sessions/${sessionId}`,
            {
                method: 'GET',
                headers,
            }
        );
        
        // 返回后端响应
        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
        
    } catch (error) {
        console.error('[session] 代理失败:', error);
        return NextResponse.json(
            { detail: '服务暂时不可用，请稍后重试' },
            { status: 502 }
        );
    }
}
