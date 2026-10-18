import { ProductShell } from "./components/product-shell";
import { WorkbenchHome } from "./workbench-home";

export default function Home() {
  return (
    <ProductShell active="overview">
      <main className="product-page workbench-page">
        <WorkbenchHome />
      </main>
    </ProductShell>
  );
}
