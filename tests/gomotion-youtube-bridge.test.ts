import test from 'node:test';
import assert from 'node:assert/strict';
import {bridgeSecretValid,scopedYoutubeChannel,safeBridgeMetrics} from '../src/lib/gomotion-bridge-policy';

test('requires strong, exact bridge secret',()=>{
 const secret='a'.repeat(40);
 assert.equal(bridgeSecretValid(secret,secret),true);
 assert.equal(bridgeSecretValid('wrong',secret),false);
 assert.equal(bridgeSecretValid(null,secret),false);
 assert.equal(bridgeSecretValid('short','short'),false);
 assert.equal(bridgeSecretValid(secret,undefined),false);
});
test('scopes channel to exact allowed YouTube ID',()=>{
 const id='UCRBCnTUJ_ow5dXxENuNkdHA';
 const channels=[
  {youtubeChannelId:'UCOtherChannel___________',status:'connected',isPrimary:true},
  {youtubeChannelId:id,status:'connected',isPrimary:false},
  {youtubeChannelId:id,status:'needs-reauth',isPrimary:true}
 ];
 assert.equal(scopedYoutubeChannel(channels,id)?.status,'connected');
 assert.equal(scopedYoutubeChannel(channels,'UCMissing______________'),null);
 assert.equal(scopedYoutubeChannel(channels,''),null);
});
test('only whitelisted finite numeric metrics escape bridge',()=>{
 const metrics=safeBridgeMetrics({
  views:100,ctrPercent:7.8,impressions:21000,
  accessToken:'secret',comments:[{text:'private'}],revenue:NaN
 });
 assert.deepEqual(metrics,{views:100,impressions:21000,ctrPercent:7.8});
});
