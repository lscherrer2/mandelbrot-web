import { Explorer } from "./components/Explorer"
import { Sidebar } from "./components/Sidebar"

export default function App() {
  return (
    <div className="relative w-full h-full bg-zinc-950 text-zinc-100 select-none">
      <Explorer />
      <Sidebar />
    </div>
  )
}
