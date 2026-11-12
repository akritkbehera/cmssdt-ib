/** Preserve configuration path spelling; normalize only GPU vendor/model labels. */
export function testDeviceLabel(name = '', type = 'gpu') {
  const parts=String(name).split('/');
  let model=parts.shift() || '';
  if(type==='gpu'){
    if(/^(nvidia|amd)$/i.test(model) && parts.length && !/^el\d|^fc\d/i.test(parts[0]))
      model+='_'+parts.shift();
    model=model.replace(/[\s:_-]+/g,'_').toUpperCase();
  }
  return {model,path:parts.join('/')};
}
