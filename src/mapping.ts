import {
  BigInt,
  JSONValueKind,
  ipfs,
  json,
  log,
  Bytes,
} from "@graphprotocol/graph-ts";
import { integer, ADDRESS_ZERO } from "@protofire/subgraph-toolkit";
import {
  Contract,
  SalePriceSet,
  WhitelistCreator as WhitelistCreatorEvent,
  Bid as BidEvent,
  AcceptBid as AcceptBidEvent,
  CancelBid as CancelBidEvent,
  Sold as SoldEvent,
  SalePriceSet as SalePriceSetEvent,
  Transfer as TransferEvent,
  Approval as ApprovalEvent,
} from "../generated/Contract/Contract";
import { Account, Artwork, BidLog, SaleLog } from "../generated/schema";

import { Address } from "@graphprotocol/graph-ts";

export function getOrCreateAccount(
  address: Address,
  persist: boolean = true
): Account {
  let accountAddress = address.toHex();
  let account = Account.load(accountAddress);

  if (account == null) {
    account = new Account(accountAddress);
    account.address = address;

    if (persist) {
      account.save();
    }
  }

  return account as Account;
}

export function handleBid(event: BidEvent): void {
  let tokenId = event.params._tokenId.toString();
  let item = Artwork.load("V1-" + tokenId);

  if (item != null) {
    let bidder = getOrCreateAccount(event.params._bidder);

    // Persist bid log
    let bid = new BidLog(
      tokenId + "-" + bidder.id
    );
    bid.amount = event.params._amount;
    bid.bidder = bidder.id;
    bid.item = item.id;
    bid.timestamp = event.block.timestamp;
    bid.resolved = false;
    //item.onSale = true;
    bid.save();
    item.bids.push(bid.id);
    item.save();
    // Update current bidder
    item.currentBid = bid.id;

    item.save();
  }
}

export function handleAcceptBid(event: AcceptBidEvent): void {
    let tokenId = event.params._tokenId.toString();
    let item = Artwork.load("V1-" + tokenId);
  
    if (item != null) {
      let bidder = getOrCreateAccount(event.params._bidder);
  
      // Persist bid log
      let bid = BidLog.load(
        tokenId + "-" + bidder.id
      );
      bid.resolved = true;
      bid.isAccepted = true;
  
      bid.save();
      item.lastSoldPrice = bid.amount;
      // Update current bidder
      item.currentBid = bid.id;
      item.onSale = false;
      item.save();
    }
}

export function handleCancelBid(event: CancelBidEvent): void {
    let tokenId = event.params._tokenId.toString();
    let item = Artwork.load("V1-" + tokenId);
  
    if (item != null) {
      let bidder = getOrCreateAccount(event.params._bidder);
  
      // Persist bid log
      let bid = BidLog.load(
        tokenId + "-" + bidder.id
      );
      bid.resolved = true;
      bid.isAccepted = false;
  
      bid.save();
    }
}

export function handleSold(event: SoldEvent): void {
  let tokenId = event.params._tokenId.toString();
  let item = Artwork.load("V1-" + tokenId);

  if (item != null) {
    let buyer = getOrCreateAccount(event.params._buyer);
    let seller = getOrCreateAccount(event.params._seller);

    // Persist sale log
    let sale = new SaleLog(
      tokenId +
        "-" +
        buyer.id +
        "-" +
        seller.id +
        "-" +
        event.block.timestamp.toString()
    );
    sale.amount = event.params._amount;
    sale.buyer = buyer.id;
    sale.item = item.id;
    sale.seller = seller.id;
    sale.timestamp = event.block.timestamp;

    sale.save();
    item.sales.push(sale.id);
    item.lastSoldPrice = sale.amount;
    item.save();
    // Transfer item to buyer
    item.owner = buyer.id;
    item.onSale = false;
    item.save();
  }
}

export function handleSalePriceSet(event: SalePriceSetEvent): void {
  let item = Artwork.load("V1-" + event.params._tokenId.toString());

  if (item != null) {
    item.salePrice = event.params._price;
    item.onSale = true;
    item.save();
  }
}

export function handleTransfer(event: TransferEvent): void {
  let account = getOrCreateAccount(event.params._to);
  let tokenId = event.params._tokenId.toString();

  if (event.params._from.toHex() == ADDRESS_ZERO) {
    // Mint token
    let item = new Artwork("V1-" + tokenId);
    item.version = "V1";
    item.creator = account.id;
    item.owner = item.creator;
    item.tokenId = event.params._tokenId;
    item.descriptorUri = Contract.bind(event.address).tokenURI(
      event.params._tokenId
    );
    item.onSale = false;
    item.created = event.block.timestamp;

    readArtworkMetadata(item as Artwork).save();
  } else {
    let item = Artwork.load("V1-" + tokenId);

    if (item != null) {
      if (event.params._to.toHex() == ADDRESS_ZERO) {
        // Burn token
        item.removed = event.block.timestamp;
      } else {
        // Transfer token
        item.owner = account.id;
        item.modified = event.block.timestamp;
        item.onSale = false;
        item.salePrice = null;
      }

      item.save();
    } else {
      log.warning("Artwork #{} not exists", [tokenId]);
    }
  }
}

function readArtworkMetadata(item: Artwork): Artwork {
  let hash = getIpfsHash(item.descriptorUri);
  
  if (hash != null) {
    let raw = ipfs.cat(hash);

    item.descriptorHash = hash;
    
    if (raw != null) {
        
      let result = json.try_fromBytes(raw as Bytes);
      if (result.isOk) { 
        let value = result.value
        if (value.kind == JSONValueKind.OBJECT) {
            let data = value.toObject();
    
            if (data.isSet("name")) {
              item.name = data.get("name").toString();
            }
    
            if (data.isSet("description")) {
              item.description = data.get("description").toString();
            }
    
            if (data.isSet("yearCreated")) {
              item.yearCreated = data.get("yearCreated").toString();
            }
    
            if (data.isSet("createdBy")) {
              item.createdBy = data.get("createdBy").toString();
            }
    
            if (data.isSet("image")) {
              item.imageUri = data.get("image").toString();
              item.imageHash = getIpfsHash(item.imageUri);
            }
    
            if (data.isSet("tags")) {
              item.tags = data
                .get("tags")
                .toArray()
                .map<string>((t) => t.toString());
            }
          }   
      } else {
        // Handle the error
       let error = result.error
       log.error("ReadMetaData Error - ", [error.toString()]);
      }
      
    }
  }

  return item;
}

export function getIpfsHash(uri: string | null): string | null {
  if (uri != null) {
    let hash = uri.split("/").pop();

    if (hash != null && hash.startsWith("Qm")) {
      return hash;
    }
  }

  return null;
}
