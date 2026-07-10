# Loop Contract 模板

> 新 loop 复制本模板到 `domains/{name}/README.md` 后填空。  
> **`## Verify` 为必填**——没有可执行的验证，就没有 loop。

| 字段 | 说明 |
|---|---|
| Domain | `domains/{name}/` |
| 执行器 | DeepSeek tools / Cursor Agent / 确定性脚本 |
| Trigger | 事件名或 CLI |

## 你是谁

（一句话角色）

## 目标

（本轮要产出什么）

## Trigger

（谁/什么事件启动本 loop）

## 输入（必须先读）

1. 本合同
2. …

## 输出

| 路径 | 说明 |
|---|---|

## 能做什么

- …

## 不能做什么（硬边界）

- …

## Verify（必填）

> 怎样判断**本次结果有效**。优先确定性检查（exit code / 字段校验）；LLM 自评不能作为唯一通过条件。

| 项 | 说明 |
|---|---|
| **通过条件** | … |
| **失败时读什么** | 命令 stdout/stderr、缺字段名、门禁原因 |
| **是否允许重试** | 是/否；预算（轮次） |
| **失败升级** | 发 `*.failed` / 记 log / 【人工】 |

**与独立 verifier loop 的关系**（若适用）：合同内 Verify ≠ 可省略末尾 maker-checker。

## Budget（建议）

- 最大工具轮次 / 连续验证失败次数：…

## Human gate（若有）

- …

## 停止条件

- …

## 失败时怎么记录

- …
