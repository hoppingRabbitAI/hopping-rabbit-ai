"""
Lepus AI - 创建 Mock 用户脚本
运行: python scripts/create_mock_user.py
"""
import os
import sys

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from supabase import create_client

# Supabase 配置
SUPABASE_URL = "https://rduiyxvzknaxomrrehzs.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_enTPpV6FhkHsPOqZlH5mRQ_mVIr2HW-"
SUPABASE_SERVICE_KEY = "sb_secret__e-nF99mafXRwEs1LxO1gQ_9RuLWska"

# Mock 用户配置
MOCK_EMAIL = "hxymock@ai.com"
MOCK_PASSWORD = "0000"

def main():
    print("=" * 50)
    print("Lepus AI - Mock 用户创建")
    print("=" * 50)
    
    # 使用 service_key 创建管理员客户端
    print(f"\n尝试使用 Service Key 通过 Admin API 创建用户...")
    
    try:
        # 使用 service key 连接（具有管理员权限）
        supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        
        # 使用 admin API 创建用户
        result = supabase.auth.admin.create_user({
            "email": MOCK_EMAIL,
            "password": MOCK_PASSWORD,
            "email_confirm": True,  # 自动确认邮箱
        })
        
        if result.user:
            print(f"\n✅ 用户创建成功!")
            print(f"   User ID: {result.user.id}")
            print(f"   Email: {result.user.email}")
            print(f"   状态: 已确认")
            print(f"\n可以使用以下账号登录:")
            print(f"   邮箱: {MOCK_EMAIL}")
            print(f"   密码: {MOCK_PASSWORD}")
        else:
            print(f"\n❌ 创建失败")
            
    except Exception as e:
        error_msg = str(e)
        print(f"\n错误详情: {error_msg}")
        
        if "already been registered" in error_msg.lower() or "already exists" in error_msg.lower():
            print(f"\n✅ 用户已存在: {MOCK_EMAIL}")
            print(f"   可以直接使用该账号登录")
            print(f"\n登录信息:")
            print(f"   邮箱: {MOCK_EMAIL}")
            print(f"   密码: {MOCK_PASSWORD}")
        else:
            print(f"\n请手动在 Supabase Dashboard 创建用户:")
            print(f"1. 访问: https://supabase.com/dashboard/project/rduiyxvzknaxomrrehzs")
            print(f"2. 点击左侧菜单 'Authentication' -> 'Users'")
            print(f"3. 点击 'Add user' -> 'Create new user'")
            print(f"4. 输入以下信息:")
            print(f"   - Email: {MOCK_EMAIL}")
            print(f"   - Password: {MOCK_PASSWORD}")
            print(f"   - 勾选 'Auto Confirm User' (跳过邮箱验证)")
            print(f"5. 点击 'Create user'")


if __name__ == "__main__":
    main()
