# Feedback 工件示例

HTTP sync 不可用时，可手写放入 `artifacts/feedback/`。

```markdown
---
id: demo-001
type: bug
status: open
source: manual
user_id: null
user_email: null
contact: null
loop_status: pending
signal_id: null
created_at: "2026-01-01T00:00:00.000Z"
updated_at: "2026-01-01T00:00:00.000Z"
synced_at: "2026-01-01T00:00:00.000Z"
---

## Content

点击提交后没有响应。
```

然后：

```bash
loop-engineer feedback
loop-engineer task
```
