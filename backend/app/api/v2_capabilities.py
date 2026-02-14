"""
Capability API (PRD v1.1 §5)

路由:
- GET  /api/v2/capabilities              获取所有能力
- GET  /api/v2/capabilities/:type         获取能力定义
- POST /api/v2/capabilities/execute       执行能力
- GET  /api/v2/capabilities/executions/:id  查询执行状态
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

from app.services.capability_executor_service import get_capability_executor_service
from .auth import get_current_user_id

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v2/capabilities", tags=["V2 Capabilities"])


# ==========================================
# 请求/响应模型
# ==========================================

class ExecuteCapabilityRequest(BaseModel):
    session_id: str = Field(..., description="画布 session ID")
    capability: str = Field(..., description="能力类型")
    input_urls: List[str] = Field(..., description="输入图 URL 列表")
    params: Dict[str, Any] = Field(default_factory=dict, description="参数")


class ExecuteCapabilityResponse(BaseModel):
    execution_id: str
    status: str


# ==========================================
# 路由
# ==========================================

@router.get("")
async def list_capabilities():
    """获取所有可用 AI 能力"""
    service = get_capability_executor_service()
    return await service.list_capabilities()


@router.get("/registry")
async def get_capability_registry():
    """获取完整能力注册表（含 param_schema · 前端画布渲染用）"""
    service = get_capability_executor_service()
    return await service.get_registry()


@router.get("/{cap_type}")
async def get_capability(cap_type: str):
    """获取单个能力定义 + 参数 schema"""
    service = get_capability_executor_service()
    cap = await service.get_capability(cap_type)
    if not cap:
        raise HTTPException(status_code=404, detail=f"Capability '{cap_type}' not found")
    return cap


@router.post("/execute", response_model=ExecuteCapabilityResponse)
async def execute_capability(
    request: ExecuteCapabilityRequest,
    user_id: str = Depends(get_current_user_id),
):
    """执行 AI 能力"""
    service = get_capability_executor_service()
    try:
        result = await service.execute(
            session_id=request.session_id,
            user_id=user_id,
            capability=request.capability,
            input_urls=request.input_urls,
            params=request.params,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/executions/{execution_id}")
async def get_execution_status(execution_id: str):
    """查询执行状态"""
    service = get_capability_executor_service()
    result = await service.get_execution_status(execution_id)
    if not result:
        raise HTTPException(status_code=404, detail="Execution not found")
    return result


# ---- 新增: execute-chain (PRD §5.2) ----

class RouteStepInput(BaseModel):
    capability: str
    params: Dict[str, Any] = {}
    prompt_template: str = ""


class ExecuteChainRequest(BaseModel):
    session_id: str = Field(..., description="画布 session ID")
    route: List[RouteStepInput] = Field(..., description="能力链路")
    input_urls: List[str] = Field(..., description="初始输入图 URL 列表")


class ExecuteChainResponse(BaseModel):
    chain_id: str
    status: str
    steps: List[Dict[str, Any]] = []


@router.post("/execute-chain", response_model=ExecuteChainResponse)
async def execute_chain(
    request: ExecuteChainRequest,
    user_id: str = Depends(get_current_user_id),
):
    """按序执行整条能力链路"""
    service = get_capability_executor_service()
    from uuid import uuid4

    chain_id = str(uuid4())
    steps = []

    # Phase 0: 依次创建执行记录，由 Celery 后台按序执行
    for i, step in enumerate(request.route):
        try:
            result = await service.execute(
                session_id=request.session_id,
                user_id=user_id,
                capability=step.capability,
                input_urls=request.input_urls if i == 0 else [],
                params={**step.params, "prompt": step.prompt_template},
            )
            steps.append({
                "order": i + 1,
                "capability": step.capability,
                "execution_id": result["execution_id"],
                "status": result["status"],
            })
        except ValueError as e:
            steps.append({
                "order": i + 1,
                "capability": step.capability,
                "execution_id": None,
                "status": "error",
                "error": str(e),
            })

    return {
        "chain_id": chain_id,
        "status": "queued",
        "steps": steps,
    }
