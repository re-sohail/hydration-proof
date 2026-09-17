import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('routes/home.jsx'),
  route('static', 'routes/static.jsx'),
  route('date-now', 'routes/date-now.jsx'),
  route('math-random', 'routes/math-random.jsx'),
  route('products/:id', 'routes/products.$id.jsx'),
  route('counter', 'routes/counter.jsx'),
  route('nav-target', 'routes/nav-target.jsx'),
] satisfies RouteConfig;
