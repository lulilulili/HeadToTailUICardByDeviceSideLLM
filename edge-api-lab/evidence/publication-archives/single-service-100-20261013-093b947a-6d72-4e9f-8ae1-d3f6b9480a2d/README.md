# 完整索引的无损发布与恢复

本批原生 `index.json` 为 216,018,118 字节。它完整保留在运行电脑上；Git 发布使用 `index.json.gz`，不截断任何记录。逐例 raw、预热、最终报告、审计和公开清单仍按原路径发布。

压缩文件为 26,392,149 字节。`index.metadata.json` 保存压缩前后的 SHA-256、字节数及原恢复路径；恢复工具先验证压缩文件，再验证解压后原始字节。不同内容的已有索引不会被覆盖。

克隆后，在仓库的 `edge-api-lab` 目录执行：

```powershell
node scripts/publication-archive.mjs restore --root . --metadata evidence/publication-archives/single-service-100-20261013-093b947a-6d72-4e9f-8ae1-d3f6b9480a2d/index.metadata.json
node scripts/verify-single-service-100.mjs --manifest data/runtime/single-service-100/single-service-100-20261013-093b947a-6d72-4e9f-8ae1-d3f6b9480a2d/manifest.json
```

第一条恢复原 `storage.indexPath`；已有同 SHA 的完整文件会直接跳过。第二条只进行离线审核，不调用模型。恢复后可通过原启动 BAT 打开评测页面。

运行清单移除了进程字段，保留原始参数字段顺序，以兼容冻结校验器的序列化比较；其数据值与 `public-manifest.json` 一致。已将待发布Git文件导出到独立目录，恢复完整索引并重算4000条评分，结果为 `verified_completed`；移动目录后的Laya来源验证也全部通过。具体恢复审计见 `restored-audit.json`。

Laya 的完整 seed、cache entry 和 498 个新推理 `.service.json` 来源文件保留在 `data/runtime/laya-reuse/<本批ID>/` 原相对路径。当前机器的缓存启用配置、日志、PID、权重和虚拟环境未作为运行配置发布；新机器不会自动启用旧机器的缓存服务。

启动阶段的 `PROJECT_MANIFEST.json` 保持历史快照。最终发布文件与 SHA 另见仓库根目录 `PROJECT_FINAL_MANIFEST_2026-10-14.json`；本目录的恢复验证证据用于确认压缩没有改变原索引。
