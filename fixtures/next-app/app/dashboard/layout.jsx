export default function Layout({ children, stats }) {
  return (
    <div id="dashboard">
      <section id="dashboard-main">{children}</section>
      <aside id="dashboard-stats">{stats}</aside>
    </div>
  );
}
