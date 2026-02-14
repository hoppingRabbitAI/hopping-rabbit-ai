---
applyTo: "backend/**/*.py"
---

# Backend Python Skill — FastAPI + Celery + Supabase

## API Router Pattern

Every API module follows this structure:

```python
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.api.auth import get_current_user_id

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/resource-name", tags=["ResourceName"])

# Request/Response models defined inline at top
class CreateResourceRequest(BaseModel):
    name: str
    description: str | None = None

class ResourceResponse(BaseModel):
    success: bool = True
    data: dict | None = None

# Routes delegate to service layer — NO business logic in routes
@router.post("")
async def create_resource(
    req: CreateResourceRequest,
    user_id: str = Depends(get_current_user_id)
):
    try:
        result = await resource_service.create(user_id, req.name)
        return {"success": True, "data": result}
    except Exception as e:
        logger.error(f"Failed to create resource: {e}")
        raise HTTPException(status_code=500, detail=str(e))
```

**Key rules:**
- Always use `Depends(get_current_user_id)` for authenticated endpoints
- Return `{"success": True, "data": ...}` for success
- Raise `HTTPException` for errors
- Import and register router in `app/api/__init__.py`

## Service Layer Pattern

```python
class ResourceService:
    def __init__(self):
        self._supabase = None

    @property
    def supabase(self):
        if not self._supabase:
            from app.services.supabase_client import get_supabase_client
            self._supabase = get_supabase_client()
        return self._supabase

    async def create(self, user_id: str, name: str) -> dict:
        """创建资源"""
        result = self.supabase.table("resources").insert({
            "user_id": user_id,
            "name": name,
        }).execute()
        return result.data[0] if result.data else None
```

**Key rules:**
- Class-based services with lazy Supabase client initialization
- Async methods throughout
- Singleton pattern via module-level factory: `_instance = None; def get_service(): ...`
- Chinese docstrings are standard

## Celery Task Pattern

```python
from app.tasks.ai_task_base import (
    update_task_status, download_file_to_temp,
    upload_to_supabase, create_asset_record
)

@celery.task(queue='gpu', bind=True, max_retries=3)
def process_ai_task(self, task_id: str, params: dict):
    try:
        update_task_status(task_id, "processing", progress=0.1)
        # ... AI processing ...
        update_task_status(task_id, "completed", progress=1.0, result_url=url)
    except Exception as e:
        update_task_status(task_id, "failed", error=str(e))
        raise
```

**Key rules:**
- Always use `ai_task_base` utilities for status updates
- Download files to temp, process, upload to Supabase Storage
- Update task progress for frontend polling

## Config

```python
from app.config import get_settings
settings = get_settings()  # Singleton, reads .env
```

Access: `settings.KLING_AI_ACCESS_KEY`, `settings.SUPABASE_URL`, etc.

## Supabase Queries

```python
# SELECT
result = supabase.table("projects").select("*").eq("user_id", uid).execute()

# INSERT
result = supabase.table("projects").insert({"name": "..."}).execute()

# UPDATE
result = supabase.table("projects").update({"name": "..."}).eq("id", pid).execute()

# DELETE
result = supabase.table("projects").delete().eq("id", pid).execute()
```

## Credits Integration

Before any AI task, check and consume credits:

```python
from app.services.credit_service import get_credit_service

credit_service = get_credit_service()
credits_needed = await credit_service.calculate_credits(model_key, params)
check = await credit_service.check_credits(user_id, credits_needed)
if not check["allowed"]:
    raise HTTPException(status_code=402, detail="Insufficient credits")
await credit_service.consume_credits(user_id, model_key, credits_needed, task_id)
```
