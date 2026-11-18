# 固定版本备份

## 备份规则

- **只保留一版**：由用户指定的那一版（默认就是当前确认可用的版本）
- 用户没特别说明时，不累积历史版本；换代时直接覆盖这一份
- 用户明确要求保留多个版本时，才按 `vX.Y.Z` 分目录保留

## 当前唯一备份：v6.10.1

| 文件 | 大小 | SHA-256 前缀 |
| --- | --- | --- |
| main.js | 35983 B | 8650894F5FB0 |
| styles.css | 4145 B | 5325338A302D |
| manifest.json | 309 B | A7BD82F63B2D |

### 这一版的能力

- 侧栏搜索面板：输入框 + ↑↓ 同行，模式（整词/包含/模糊/正则）、范围（全库/当前笔记）、Aa、高亮全部
- 索引：title / heading / line / code 四类；支持 `"短语"`、`-排除`、`OR`、`path:`、`file:`、`section:`、`/正则/`
- **编辑视图**：光标精确落行 + 选中词 + CM 装饰高亮（当前词橙圈）
- **阅读视图**：滚到小节标题触发增量渲染 → 找到命中块 → 滚到块 → 词标黄
- 章节下拉按「第N章」数字排序，99a/99b/99c 排在 99 之后
- 跳转不占用锁定标签页；接管原生搜索命令（卸载时还原）
- 诊断日志：`../debug.log`（每次点击追加几行，可随时删除）

## 回退

```powershell
$src  = "D:\EDA\1-Linux Projects\vehicle-mounted system\LInux学习笔记\.obsidian\plugins\word-search"
$dest = "$src\_backups\v6.10.1"
Copy-Item "$dest\main.js"       "$src\main.js"       -Force
Copy-Item "$dest\styles.css"    "$src\styles.css"    -Force
Copy-Item "$dest\manifest.json" "$src\manifest.json" -Force
```

然后 `Ctrl+P` → `Reload app without saving`。

校验：

```powershell
Get-FileHash "$src\main.js" | Select-Object -ExpandProperty Hash
# 应以 8650894F5FB0 开头
```
