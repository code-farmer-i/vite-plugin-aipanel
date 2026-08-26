export default {
  showAnchor(route) {
    // 首页不显示右侧锚点
    if (route.path === "/index" || route.path === "/") {
      return false;
    }
    return true;
  },
};