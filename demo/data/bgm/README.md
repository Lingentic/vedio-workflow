# 内置背景音乐

三首音乐来自 Holizna 的 **Happy Pop Electronic (Collection)**，作者在发布页明确声明 Public Domain / CC0。

- 发布页：https://opengameart.org/content/happy-pop-electronic-collection
- 原下载：https://opengameart.org/sites/default/files/happy_electronic.zip
- 许可：https://creativecommons.org/publicdomain/zero/1.0/
- 核对日期：2026-10-30
- 作者：Holizna / HoliznaCC0
- 曲目：Happy Dance、Bouncing、Earth。

仓库保留完整曲目，转为 128 kbps MP3、48 kHz 双声道，并统一响度至 -18 LUFS / -2 dBTP；未添加人声或改变旋律。CC0 无强制署名要求，本说明保留来源信息。重新打包、复制这些文件时请同时保留本说明以便追溯。

`tracks.json` 定义稳定绑定 ID 和界面名称。服务启动或切换数据目录时导入托管副本，相同绑定不重复入库，不修改已有任务的 BGM 选择。已标记删除的绑定不在重启时复活；托管副本缺失时从内置文件恢复，沿用同一资源 ID。默认不加音乐，支持试听、音量调整及合成时循环／末尾裁断。
