import { redirect } from "next/navigation";

// 联调台已迁至 /test/automl；旧路径（浏览器历史/编辑器返回链接）统一重定向，避免回退落在正式应用里
export default function AutomlLegacyPage() {
  redirect("/test/automl");
}
