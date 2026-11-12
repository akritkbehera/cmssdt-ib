const active = {os:['el8','el9'],cpu:['amd64','aarch64'],compiler:['gcc14','gcc15']};
const colors={el9:'#5cb85c',amd64:'#5cb85c',gcc14:'#5cb85c'};
export const useShowArch = () => ({
  getActiveArchsForQue: () => active,
  getColorsSchemeForQue: () => colors
});
