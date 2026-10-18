import type { Metadata } from "next";
import { ProductShell } from "../../components/product-shell";
import { AutomlWorkbench } from "./automl-workbench";

// 联调测试台：仅开发/联调用，不进正式导航；正式数据链路在 /studio/data
export const metadata: Metadata = {
  title: "AutoML 联调测试 · SenseMu",
  description: "sz-boot AutoML 接口联调测试台（令牌注入、素材上传、分片上传与标注调试）。",
};

export default function AutomlTestPage() {
  return (
    <ProductShell active="studio">
      <main className="studio-main data-page">
        <AutomlWorkbench />
      </main>
    </ProductShell>
  );
}
