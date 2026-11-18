# 第8章 Qt程序设计

6 篇主题笔记。

- [[01 环境与构建]]
	- 库文件（QWidgets）：`<QWidgets>`
	- VScode的Qt库报红解决：C/C++扩展新建Qt-arm配置（可在界面右下角点击切换），指定含实际Qt的include…
	- 程序自启动：可以编写shell脚本启动器放置到板子的etc/init.d/目录下，并将启动脚本命名为Sn…
	- QPA环境变量：全名Qt平台抽象层 (QPA, Qt Platform Abstraction)，用于在运行…
	- Kit：Qt的编译套件配置，可以配置多套Kit以适应不同的环境，最常见为使用一套桌面Desktop套…
- [[02 调试输出与信号槽]]
	- qDebug：Qt的调试输出头文件，需先include\<QDebug\>。
	- slots槽函数：Qt对标准C++的扩展，函数名需符合on_\<控件名\>_\<触发信号名\>的规范，系统会自…
	- QObject：：connect：自定义连接信号和槽函数。
	- Lambda语句（匿名函数）
- [[03 应用与基础控件]]
	- QApplication类：来自\<QApplication\>，管理 Qt 事件循环和全局资源，一个进程只能有一个。
	- QWidget类：来自\<QWidget\>，其为所有可视控件的基类，同时为顶层窗口。
	- QPushButton类：来自\<QPushButton\>，按钮控件。
- [[04 布局管理]]
	- QVBoxLayout类：来自\<QVBoxLayout\>，子控件布局管理器，安装到其内的控件是垂直布局的。
	- QGridLayout类：来自\<QGridLayout\>，子控件布局管理器，安装到其内的控件控件会按设计网格进行布局。
- [[05 文本与列表]]
	- QLabel类：来自\<QLabel\>，文本显示控件。
	- QString类：来自\<QString\>，Qt字符串类型。
	- QStringList类：来自\<QStringList\>，Qt字符串列表类型，可以给函数传“参数列表”。
- [[06 定时器与外部程序]]
	- QTimer类：来自\<QTimer\>，相当于Qt定时器（对象可作为超时信号的发送者），定时将在 Qt 事…
	- QProcess：：startDetached
